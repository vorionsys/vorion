# agentanchor.AgentsApi

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**get_agent**](AgentsApi.md#get_agent) | **GET** /agents/{id} | Get agent details
[**list_agents**](AgentsApi.md#list_agents) | **GET** /agents | List agents


# **get_agent**
> GetAgent200Response get_agent(id)

Get agent details

Retrieve detailed information about a specific agent.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.get_agent200_response import GetAgent200Response
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
    api_instance = agentanchor.AgentsApi(api_client)
    id = UUID('38400000-8cf0-11bd-b23e-10b96e4ef00d') # UUID | 

    try:
        # Get agent details
        api_response = api_instance.get_agent(id)
        print("The response of AgentsApi->get_agent:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AgentsApi->get_agent: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **UUID**|  | 

### Return type

[**GetAgent200Response**](GetAgent200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Agent details |  -  |
**401** | Invalid or missing API key |  -  |
**404** | Resource not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_agents**
> ListAgents200Response list_agents(page=page, limit=limit, status=status, published=published)

List agents

Retrieve a paginated list of agents. Returns user's agents if authenticated, otherwise public marketplace agents.

### Example

* Bearer Authentication (BearerAuth):

```python
import agentanchor
from agentanchor.models.list_agents200_response import ListAgents200Response
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
    api_instance = agentanchor.AgentsApi(api_client)
    page = 1 # int |  (optional) (default to 1)
    limit = 20 # int |  (optional) (default to 20)
    status = 'status_example' # str |  (optional)
    published = True # bool |  (optional)

    try:
        # List agents
        api_response = api_instance.list_agents(page=page, limit=limit, status=status, published=published)
        print("The response of AgentsApi->list_agents:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AgentsApi->list_agents: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **page** | **int**|  | [optional] [default to 1]
 **limit** | **int**|  | [optional] [default to 20]
 **status** | **str**|  | [optional] 
 **published** | **bool**|  | [optional] 

### Return type

[**ListAgents200Response**](ListAgents200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of agents |  -  |
**401** | Invalid or missing API key |  -  |
**429** | Rate limit exceeded |  * X-RateLimit-Limit -  <br>  * X-RateLimit-Remaining -  <br>  * X-RateLimit-Reset -  <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

