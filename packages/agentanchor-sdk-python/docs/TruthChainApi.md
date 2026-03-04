# agentanchor.TruthChainApi

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**create_truth_chain_record**](TruthChainApi.md#create_truth_chain_record) | **POST** /truth-chain | Create truth chain record
[**list_truth_chain_records**](TruthChainApi.md#list_truth_chain_records) | **GET** /truth-chain | List truth chain records
[**verify_truth_chain_record**](TruthChainApi.md#verify_truth_chain_record) | **GET** /truth-chain/verify/{hash} | Verify record


# **create_truth_chain_record**
> CreateTruthChainRecord201Response create_truth_chain_record(create_truth_chain_record_request)

Create truth chain record

Create a new immutable record on the truth chain. Requires admin scope.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.create_truth_chain_record201_response import CreateTruthChainRecord201Response
from agentanchor.models.create_truth_chain_record_request import CreateTruthChainRecordRequest
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization: BearerAuth
configuration = agentanchor.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.TruthChainApi(api_client)
    create_truth_chain_record_request = agentanchor.CreateTruthChainRecordRequest() # CreateTruthChainRecordRequest | 

    try:
        # Create truth chain record
        api_response = api_instance.create_truth_chain_record(create_truth_chain_record_request)
        print("The response of TruthChainApi->create_truth_chain_record:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling TruthChainApi->create_truth_chain_record: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **create_truth_chain_record_request** | [**CreateTruthChainRecordRequest**](CreateTruthChainRecordRequest.md)|  | 

### Return type

[**CreateTruthChainRecord201Response**](CreateTruthChainRecord201Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Created record |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_truth_chain_records**
> ListTruthChainRecords200Response list_truth_chain_records(agent_id=agent_id, record_type=record_type, limit=limit)

List truth chain records

Retrieve immutable governance records from the truth chain.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.list_truth_chain_records200_response import ListTruthChainRecords200Response
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure Bearer authorization: BearerAuth
configuration = agentanchor.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.TruthChainApi(api_client)
    agent_id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID |  (optional)
    record_type = 'record_type_example' # str |  (optional)
    limit = 50 # int |  (optional) (default to 50)

    try:
        # List truth chain records
        api_response = api_instance.list_truth_chain_records(agent_id=agent_id, record_type=record_type, limit=limit)
        print("The response of TruthChainApi->list_truth_chain_records:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling TruthChainApi->list_truth_chain_records: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **agent_id** | **UUID**|  | [optional] 
 **record_type** | **str**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]

### Return type

[**ListTruthChainRecords200Response**](ListTruthChainRecords200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of truth chain records |  -  |
**401** | Invalid or missing API key |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **verify_truth_chain_record**
> VerificationResult verify_truth_chain_record(hash)

Verify record

Verify the authenticity and chain integrity of a truth chain record. This endpoint is public.

### Example


```python
import agentanchor
from agentanchor.models.verification_result import VerificationResult
from agentanchor.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to https://app.agentanchorai.com/api/v1
# See configuration.py for a list of all supported configuration parameters.
configuration = agentanchor.Configuration(
    host = "https://app.agentanchorai.com/api/v1"
)


# Enter a context with an instance of the API client
with agentanchor.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = agentanchor.TruthChainApi(api_client)
    hash = 'hash_example' # str | SHA-256 hash of the record

    try:
        # Verify record
        api_response = api_instance.verify_truth_chain_record(hash)
        print("The response of TruthChainApi->verify_truth_chain_record:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling TruthChainApi->verify_truth_chain_record: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **hash** | **str**| SHA-256 hash of the record | 

### Return type

[**VerificationResult**](VerificationResult.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Verification result |  -  |
**404** | Resource not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

