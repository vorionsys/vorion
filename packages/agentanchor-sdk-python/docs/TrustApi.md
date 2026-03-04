# agentanchor.TrustApi

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**apply_trust_change**](TrustApi.md#apply_trust_change) | **POST** /agents/{id}/trust | Apply trust change
[**get_trust_history**](TrustApi.md#get_trust_history) | **GET** /agents/{id}/trust | Get trust history


# **apply_trust_change**
> ApplyTrustChange200Response apply_trust_change(id, trust_change)

Apply trust change

Apply a trust score change to an agent. Requires write scope.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.apply_trust_change200_response import ApplyTrustChange200Response
from agentanchor.models.trust_change import TrustChange
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
    api_instance = agentanchor.TrustApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    trust_change = agentanchor.TrustChange() # TrustChange | 

    try:
        # Apply trust change
        api_response = api_instance.apply_trust_change(id, trust_change)
        print("The response of TrustApi->apply_trust_change:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling TrustApi->apply_trust_change: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **trust_change** | [**TrustChange**](TrustChange.md)|  | 

### Return type

[**ApplyTrustChange200Response**](ApplyTrustChange200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Updated trust information |  -  |
**401** | Invalid or missing API key |  -  |
**404** | Resource not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_trust_history**
> GetTrustHistory200Response get_trust_history(id, limit=limit)

Get trust history

Retrieve trust score change history for an agent.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.get_trust_history200_response import GetTrustHistory200Response
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
    api_instance = agentanchor.TrustApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 
    limit = 50 # int |  (optional) (default to 50)

    try:
        # Get trust history
        api_response = api_instance.get_trust_history(id, limit=limit)
        print("The response of TrustApi->get_trust_history:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling TrustApi->get_trust_history: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 
 **limit** | **int**|  | [optional] [default to 50]

### Return type

[**GetTrustHistory200Response**](GetTrustHistory200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Trust history records |  -  |
**401** | Invalid or missing API key |  -  |
**404** | Resource not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

